-- Work Guideline native integration schema for Muxamil.co.
-- Additive only: every table is prefixed wg_; no existing mux_* table is altered.
-- API handlers use the server-side Supabase secret + Prisma connection.

BEGIN;

CREATE TABLE IF NOT EXISTS public.wg_users (
  "id" TEXT NOT NULL,
  "supabaseUserId" TEXT,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'USER',
  "isRestricted" BOOLEAN NOT NULL DEFAULT FALSE,
  "emailVerifiedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_users_supabaseUserId_key" ON public.wg_users ("supabaseUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "wg_users_email_key" ON public.wg_users ("email");

CREATE TABLE IF NOT EXISTS public.wg_rewards_programs (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '',
  "requirements" TEXT NOT NULL DEFAULT '[]',
  "paymentMethods" TEXT NOT NULL DEFAULT '[]',
  "requiresCode" BOOLEAN NOT NULL DEFAULT TRUE,
  "icon" TEXT NOT NULL DEFAULT 'gift',
  "accent" TEXT NOT NULL DEFAULT 'violet',
  "tutorialCtaLabel" TEXT NOT NULL DEFAULT '',
  "submitCtaLabel" TEXT NOT NULL DEFAULT '',
  "tutorialCtaUrl" TEXT NOT NULL DEFAULT '',
  "showTutorialCta" BOOLEAN NOT NULL DEFAULT TRUE,
  "showSubmitCta" BOOLEAN NOT NULL DEFAULT TRUE,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_rewards_programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_rewards_programs_slug_key" ON public.wg_rewards_programs ("slug");

CREATE TABLE IF NOT EXISTS public.wg_program_guides (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_program_guides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_program_guides_programId_key" ON public.wg_program_guides ("programId");

CREATE INDEX IF NOT EXISTS "wg_program_guides_status_idx" ON public.wg_program_guides ("status");

CREATE TABLE IF NOT EXISTS public.wg_card_rates (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "rate" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PKR',
  "minValue" DOUBLE PRECISION,
  "maxValue" DOUBLE PRECISION,
  "badge" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "logoPath" TEXT NOT NULL DEFAULT '',
  "bannerPath" TEXT NOT NULL DEFAULT '',
  "programId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_card_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_card_rates_code_key" ON public.wg_card_rates ("code");

CREATE INDEX IF NOT EXISTS "wg_card_rates_isActive_displayOrder_idx" ON public.wg_card_rates ("isActive", "displayOrder");

CREATE INDEX IF NOT EXISTS "wg_card_rates_programId_idx" ON public.wg_card_rates ("programId");

CREATE TABLE IF NOT EXISTS public.wg_currencies (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL DEFAULT '',
  "decimals" INTEGER NOT NULL DEFAULT 0,
  "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "rateToDefault" DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_currencies_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS public.wg_payment_methods (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL DEFAULT '',
  "accountHolderName" TEXT NOT NULL DEFAULT '',
  "accountNumber" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'mobile',
  "accountLabel" TEXT NOT NULL DEFAULT '',
  "accountNameLabel" TEXT NOT NULL DEFAULT 'Account holder name',
  "requiresAccountName" BOOLEAN NOT NULL DEFAULT TRUE,
  "minPayout" DOUBLE PRECISION,
  "maxPayout" DOUBLE PRECISION,
  "logoPath" TEXT NOT NULL DEFAULT '',
  "bannerPath" TEXT NOT NULL DEFAULT '',
  "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_payment_methods_code_key" ON public.wg_payment_methods ("code");

CREATE TABLE IF NOT EXISTS public.wg_tutorial_steps (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "videoUrl" TEXT NOT NULL DEFAULT '',
  "thumbnailUrl" TEXT NOT NULL DEFAULT '',
  "aspectRatio" TEXT NOT NULL DEFAULT 'auto',
  "detectedWidth" INTEGER NOT NULL DEFAULT 0,
  "detectedHeight" INTEGER NOT NULL DEFAULT 0,
  "detectedSource" TEXT NOT NULL DEFAULT '',
  "isPublished" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_tutorial_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_tutorial_steps_programId_stepNumber_key" ON public.wg_tutorial_steps ("programId", "stepNumber");

CREATE TABLE IF NOT EXISTS public.wg_tutorial_progress (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "openedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_tutorial_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_tutorial_progress_userId_programId_stepNumber_key" ON public.wg_tutorial_progress ("userId", "programId", "stepNumber");

CREATE INDEX IF NOT EXISTS "wg_tutorial_progress_userId_programId_idx" ON public.wg_tutorial_progress ("userId", "programId");

CREATE TABLE IF NOT EXISTS public.wg_submissions (
  "id" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "submissionKind" TEXT NOT NULL DEFAULT 'CARD',
  "programId" TEXT,
  "cardRateId" TEXT,
  "cardName" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "screenshotPath" TEXT,
  "gmailTotalChecked" INTEGER,
  "gmailValid" INTEGER,
  "gmailInvalid" INTEGER,
  "gmailUnverified" INTEGER,
  "gmailQuantity" INTEGER,
  "gmailEntries" TEXT,
  "redemptionCode" TEXT NOT NULL DEFAULT '',
  "memberNote" TEXT NOT NULL DEFAULT '',
  "gmailAccepted" INTEGER,
  "gmailRejected" INTEGER,
  "gmailReview" TEXT,
  "gmailRatePerEntry" DOUBLE PRECISION,
  "eligibleAmount" DOUBLE PRECISION,
  "paymentMethod" TEXT NOT NULL DEFAULT '',
  "paymentAccount" TEXT NOT NULL DEFAULT '',
  "paymentAccountName" TEXT NOT NULL DEFAULT '',
  "paymentDetailsAt" TIMESTAMPTZ,
  "notes" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT_DETAILS',
  "adminNotes" TEXT NOT NULL DEFAULT '',
  "rejectionReason" TEXT NOT NULL DEFAULT '',
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deadlineAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_submissions_referenceId_key" ON public.wg_submissions ("referenceId");

CREATE UNIQUE INDEX IF NOT EXISTS "wg_submissions_userId_idempotencyKey_key" ON public.wg_submissions ("userId", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "wg_submissions_userId_idx" ON public.wg_submissions ("userId");

CREATE INDEX IF NOT EXISTS "wg_submissions_status_idx" ON public.wg_submissions ("status");

CREATE INDEX IF NOT EXISTS "wg_submissions_programId_idx" ON public.wg_submissions ("programId");

CREATE INDEX IF NOT EXISTS "wg_submissions_deadlineAt_idx" ON public.wg_submissions ("deadlineAt");

CREATE TABLE IF NOT EXISTS public.wg_submission_status_history (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "changedByName" TEXT NOT NULL DEFAULT 'System',
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wg_submission_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wg_submission_status_history_submissionId_idx" ON public.wg_submission_status_history ("submissionId");

CREATE TABLE IF NOT EXISTS public.wg_payment_records (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "paymentRef" TEXT NOT NULL,
  "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "method" TEXT NOT NULL,
  "transactionRef" TEXT NOT NULL DEFAULT '',
  "proofPath" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "paidAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_payment_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wg_payment_records_paymentRef_key" ON public.wg_payment_records ("paymentRef");

CREATE INDEX IF NOT EXISTS "wg_payment_records_status_idx" ON public.wg_payment_records ("status");

CREATE INDEX IF NOT EXISTS "wg_payment_records_createdAt_idx" ON public.wg_payment_records ("createdAt");

CREATE TABLE IF NOT EXISTS public.wg_notifications (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "link" TEXT NOT NULL DEFAULT '',
  "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wg_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wg_notifications_userId_isRead_idx" ON public.wg_notifications ("userId", "isRead");

CREATE TABLE IF NOT EXISTS public.wg_site_settings (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "wg_site_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS public.wg_admin_audit_logs (
  "id" TEXT NOT NULL,
  "adminId" TEXT,
  "adminName" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL DEFAULT '',
  "targetId" TEXT NOT NULL DEFAULT '',
  "details" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wg_admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wg_admin_audit_logs_createdAt_idx" ON public.wg_admin_audit_logs ("createdAt");

CREATE TABLE IF NOT EXISTS public.wg_contact_messages (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT '',
  "message" TEXT NOT NULL,
  "isHandled" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "wg_contact_messages_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_program_guides_programId_fkey') THEN
    ALTER TABLE public.wg_program_guides ADD CONSTRAINT "wg_program_guides_programId_fkey" FOREIGN KEY ("programId") REFERENCES public.wg_rewards_programs("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_card_rates_programId_fkey') THEN
    ALTER TABLE public.wg_card_rates ADD CONSTRAINT "wg_card_rates_programId_fkey" FOREIGN KEY ("programId") REFERENCES public.wg_rewards_programs("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_tutorial_steps_programId_fkey') THEN
    ALTER TABLE public.wg_tutorial_steps ADD CONSTRAINT "wg_tutorial_steps_programId_fkey" FOREIGN KEY ("programId") REFERENCES public.wg_rewards_programs("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_tutorial_progress_userId_fkey') THEN
    ALTER TABLE public.wg_tutorial_progress ADD CONSTRAINT "wg_tutorial_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.wg_users("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_tutorial_progress_programId_fkey') THEN
    ALTER TABLE public.wg_tutorial_progress ADD CONSTRAINT "wg_tutorial_progress_programId_fkey" FOREIGN KEY ("programId") REFERENCES public.wg_rewards_programs("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_submissions_userId_fkey') THEN
    ALTER TABLE public.wg_submissions ADD CONSTRAINT "wg_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.wg_users("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_submissions_programId_fkey') THEN
    ALTER TABLE public.wg_submissions ADD CONSTRAINT "wg_submissions_programId_fkey" FOREIGN KEY ("programId") REFERENCES public.wg_rewards_programs("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_submissions_cardRateId_fkey') THEN
    ALTER TABLE public.wg_submissions ADD CONSTRAINT "wg_submissions_cardRateId_fkey" FOREIGN KEY ("cardRateId") REFERENCES public.wg_card_rates("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_submission_status_history_submissionId_fkey') THEN
    ALTER TABLE public.wg_submission_status_history ADD CONSTRAINT "wg_submission_status_history_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES public.wg_submissions("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_payment_records_submissionId_fkey') THEN
    ALTER TABLE public.wg_payment_records ADD CONSTRAINT "wg_payment_records_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES public.wg_submissions("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_notifications_userId_fkey') THEN
    ALTER TABLE public.wg_notifications ADD CONSTRAINT "wg_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.wg_users("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_admin_audit_logs_adminId_fkey') THEN
    ALTER TABLE public.wg_admin_audit_logs ADD CONSTRAINT "wg_admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public.wg_users("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wg_contact_messages_userId_fkey') THEN
    ALTER TABLE public.wg_contact_messages ADD CONSTRAINT "wg_contact_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.wg_users("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE public.wg_users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_users FROM anon, authenticated;

ALTER TABLE public.wg_rewards_programs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_rewards_programs FROM anon, authenticated;

ALTER TABLE public.wg_program_guides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_program_guides FROM anon, authenticated;

ALTER TABLE public.wg_card_rates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_card_rates FROM anon, authenticated;

ALTER TABLE public.wg_currencies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_currencies FROM anon, authenticated;

ALTER TABLE public.wg_payment_methods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_payment_methods FROM anon, authenticated;

ALTER TABLE public.wg_tutorial_steps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_tutorial_steps FROM anon, authenticated;

ALTER TABLE public.wg_tutorial_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_tutorial_progress FROM anon, authenticated;

ALTER TABLE public.wg_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_submissions FROM anon, authenticated;

ALTER TABLE public.wg_submission_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_submission_status_history FROM anon, authenticated;

ALTER TABLE public.wg_payment_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_payment_records FROM anon, authenticated;

ALTER TABLE public.wg_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_notifications FROM anon, authenticated;

ALTER TABLE public.wg_site_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_site_settings FROM anon, authenticated;

ALTER TABLE public.wg_admin_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_admin_audit_logs FROM anon, authenticated;

ALTER TABLE public.wg_contact_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wg_contact_messages FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON TABLE public.wg_users, public.wg_rewards_programs, public.wg_program_guides, public.wg_card_rates, public.wg_currencies, public.wg_payment_methods, public.wg_tutorial_steps, public.wg_tutorial_progress, public.wg_submissions, public.wg_submission_status_history, public.wg_payment_records, public.wg_notifications, public.wg_site_settings, public.wg_admin_audit_logs, public.wg_contact_messages TO service_role;

-- Private Work Guideline uploads; server-side service key mediates all file access.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wg-private', 'wg-private', false, 52428800)
ON CONFLICT (id) DO NOTHING;

COMMIT;
