"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { useReducedMotionSafe as useReducedMotion } from "@/lib/wg/use-reduced-motion";
import { useApp } from "@/components/work-guideline/provider";
import { matchRoute, navigate, useRoute } from "@/components/work-guideline/router";
import { Landing } from "@/components/work-guideline/landing";
import { ForgotPasswordView, ResetPasswordView } from "@/components/work-guideline/auth";
import { DashboardView } from "@/components/work-guideline/dashboard";
import { CardRatesView } from "@/components/work-guideline/card-rates";
import { CountdownView } from "@/components/work-guideline/countdown";
import { ProgramsListView, ProgramDetailView } from "@/components/work-guideline/programs";
import { TutorialView } from "@/components/work-guideline/tutorial";
import { SubmitView } from "@/components/work-guideline/submit";
import { GmailSubmitView } from "@/components/work-guideline/gmail";
import { WorkflowView } from "@/components/work-guideline/workflow";
import { SubmissionsListView, SubmissionDetailView } from "@/components/work-guideline/submissions";
import { PaymentHistoryView, TransactionDetailView } from "@/components/work-guideline/payments";
import { NotificationsView } from "@/components/work-guideline/notifications";
import { ProfileView } from "@/components/work-guideline/profile";
import { PrivacyView, TermsView, ContactView, NotFoundView } from "@/components/work-guideline/pages";
import { AdminLayout } from "@/components/work-guideline/admin/layout";
import { AdminOverview } from "@/components/work-guideline/admin/overview";
import { AdminProgramsVideos } from "@/components/work-guideline/admin/programs";
import { AdminSubmissions } from "@/components/work-guideline/admin/submissions";
import { AdminPayments } from "@/components/work-guideline/admin/payments";
import { AdminCardRates } from "@/components/work-guideline/admin/card-rates";
import { AdminGmailTask } from "@/components/work-guideline/admin/gmail-task";
import { AdminPaymentMethods } from "@/components/work-guideline/admin/payment-methods";
import { AdminSettings } from "@/components/work-guideline/admin/settings";
import { AdminGuides } from "@/components/work-guideline/admin/guides";
import { AdminMembers } from "@/components/work-guideline/admin/users";
import { AdminBranding } from "@/components/work-guideline/admin/branding";
import { GuideView } from "@/components/work-guideline/guide";
import { LoadingBlock } from "@/components/work-guideline/ui-bits";

function workHubReturnTo(target: string): string {
  const safeTarget = target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard';
  return `/work-guideline#${safeTarget}`;
}

function MuxamilAuthRedirect({ mode }: { mode: 'login' | 'register' }) {
  useEffect(() => {
    const hashRoute = window.location.hash.replace(/^#/, '');
    const queryPart = hashRoute.includes('?') ? hashRoute.slice(hashRoute.indexOf('?') + 1) : '';
    const next = new URLSearchParams(queryPart).get('next') || '/dashboard';
    const url = new URL('/', window.location.origin);
    url.searchParams.set('auth', mode);
    url.searchParams.set('returnTo', workHubReturnTo(next));
    window.location.replace(url.toString());
  }, [mode]);

  return <LoadingBlock label={`Opening Muxamil ${mode === 'login' ? 'sign in' : 'account creation'}…`} />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loadingAuth } = useApp();
  const target = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") || "/dashboard" : "/dashboard";

  useEffect(() => {
    if (!loadingAuth && !user) {
      // Use the one Muxamil account/session and return to this exact Work Hub route.
      const url = new URL('/', window.location.origin);
      url.searchParams.set('auth', 'login');
      url.searchParams.set('returnTo', workHubReturnTo(target));
      window.location.replace(url.toString());
    }
  }, [loadingAuth, user, target]);

  if (loadingAuth) return <LoadingBlock label="Checking your Muxamil account…" />;
  if (!user) return <LoadingBlock label="Opening Muxamil sign in…" />;
  return <>{children}</>;
}

const TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard/, "Dashboard"],
  [/^\/gmail\/submit/, "Submit Gmail"],
  [/^\/gmail\/submitted/, "Complete Your Submission"],
  [/^\/programs\/[^/]+\/tutorial/, "Tutorial"],
  [/^\/programs\/[^/]+/, "Program"],
  [/^\/programs/, "Rewards Programs"],
  [/^\/card-rates/, "Latest Card Rates"],
  [/^\/countdown/, "Payment Countdown"],
  [/^\/submit\/card\/[^/]+/, "Submit Your Card"],
  [/^\/submit/, "Submit Your Card"],
  [/^\/submitted/, "Complete Your Submission"],
  [/^\/payment\/[^/]+/, "Payment Details"],
  [/^\/workflow\/[^/]+/, "Complete Your Submission"],
  [/^\/submissions\/[^/]+/, "Submission Details"],
  [/^\/submissions/, "My Submissions"],
  [/^\/payments\/[^/]+/, "Transaction Details"],
  [/^\/payments/, "My Payments & History"],
  [/^\/notifications/, "Notifications"],
  [/^\/profile/, "Profile & Settings"],
  [/^\/login/, "Sign In"],
  [/^\/signup/, "Create Account"],
  [/^\/forgot-password/, "Reset Password"],
  [/^\/reset-password/, "Reset Password"],
  [/^\/admin\/card-rates/, "Card Rates"],
  [/^\/guide\//, "Guide"],
  [/^\/admin\/members/, "Members"],
  [/^\/admin\/guides/, "Read Guides"],
  [/^\/admin\/branding/, "Branding & Content"],
  [/^\/admin/, "Admin Panel"],
  [/^\/privacy/, "Privacy Policy"],
  [/^\/terms/, "Terms of Service"],
  [/^\/contact/, "Contact & Support"],
];

function viewFor(path: string): React.ReactNode {
  // Landing
  if (path === "/" || path === "") return <Landing />;

  // Auth
  if (path === "/login") return <MuxamilAuthRedirect mode="login" />;
  if (path === "/signup") return <MuxamilAuthRedirect mode="register" />;
  if (path === "/forgot-password") return <ForgotPasswordView />;
  if (path === "/reset-password") return <ResetPasswordView />;

  // User area (protected)
  if (path === "/dashboard") return <RequireAuth><DashboardView /></RequireAuth>;

  // Programs (public listing + detail)
  if (path === "/programs") return <ProgramsListView />;
  const detail = matchRoute("/programs/:slug", path);
  if (detail) return <ProgramDetailView slug={detail.slug} />;
  const tutorial = matchRoute("/programs/:slug/tutorial", path);
  if (tutorial) return <RequireAuth><TutorialView slug={tutorial.slug} /></RequireAuth>;

  // Latest card rates — public payout catalog (member journey entry point).
  if (path === "/card-rates") return <CardRatesView />;
  // Payment countdown — live review-target deadlines (protected).
  if (path === "/countdown") return <RequireAuth><CountdownView /></RequireAuth>;

  // Submission flow (protected). Two smart entry methods:
  //   /submit/card/:code — Method B: card pre-selected from Latest Card Rates
  //   /submit/:slug      — Method A: program context (card selection inside)
  const submitCard = matchRoute("/submit/card/:code", path);
  if (submitCard) return <RequireAuth><SubmitView cardCode={submitCard.code} /></RequireAuth>;
  const submit = matchRoute("/submit/:slug", path);
  if (submit) return <RequireAuth><SubmitView slug={submit.slug} /></RequireAuth>;

  // Gmail Rewards — its own dedicated guided wizard (separate from the card
  // wizard): compact overview (rate + calculator) → check & submit → the
  // SHARED payment workflow (#/workflow/:ref) and countdown/tracking views.
  const guide = matchRoute("/guide/:slug", path);
  if (guide) return <GuideView slug={guide.slug} />;
  if (path === "/gmail/submit") return <RequireAuth><GmailSubmitView /></RequireAuth>;

  // The guided payment workflow — reached automatically after a confirmed
  // Gmail OR card submission (and by direct link): payment-method selection →
  // account details → final confirmation with the processing countdown.
  // The legacy #/payment/:ref, #/submitted/:ref and #/gmail/submitted/:ref
  // links all alias here, so old notifications and bookmarks keep working —
  // the workflow resolves the correct next step from the server state.
  const workflow = matchRoute("/workflow/:ref", path);
  if (workflow) return <RequireAuth><WorkflowView referenceId={workflow.ref} /></RequireAuth>;
  const gmailSubmitted = matchRoute("/gmail/submitted/:ref", path);
  if (gmailSubmitted) return <RequireAuth><WorkflowView referenceId={gmailSubmitted.ref} /></RequireAuth>;
  const submitted = matchRoute("/submitted/:ref", path);
  if (submitted) return <RequireAuth><WorkflowView referenceId={submitted.ref} /></RequireAuth>;
  const payment = matchRoute("/payment/:ref", path);
  if (payment) return <RequireAuth><WorkflowView referenceId={payment.ref} /></RequireAuth>;
  if (path === "/submissions") return <RequireAuth><SubmissionsListView /></RequireAuth>;
  const submissionDetail = matchRoute("/submissions/:ref", path);
  if (submissionDetail) return <RequireAuth><SubmissionDetailView referenceId={submissionDetail.ref} /></RequireAuth>;

  // Payments / notifications / profile (protected)
  if (path === "/payments") return <RequireAuth><PaymentHistoryView /></RequireAuth>;
  const transactionDetail = matchRoute("/payments/:ref", path);
  if (transactionDetail) return <RequireAuth><TransactionDetailView referenceId={transactionDetail.ref} /></RequireAuth>;
  if (path === "/notifications") return <RequireAuth><NotificationsView /></RequireAuth>;
  if (path === "/profile") return <RequireAuth><ProfileView /></RequireAuth>;

  // Admin panel (role checked inside AdminLayout) — seven primary sections:
  // Dashboard · Submissions · Payments · Programs & Tutorials · Card Rates ·
  // Payment Methods · Settings. Legacy bookmarks keep working and open the
  // owning section with the right internal tab.
  if (path === "/admin") return <AdminLayout><AdminOverview /></AdminLayout>;
  if (path === "/admin/tutorials") return <AdminLayout><AdminProgramsVideos /></AdminLayout>;
  if (path === "/admin/programs") return <AdminLayout><AdminProgramsVideos /></AdminLayout>;
  if (path === "/admin/videos") return <AdminLayout><AdminProgramsVideos /></AdminLayout>;
  if (path === "/admin/submissions") return <AdminLayout><AdminSubmissions /></AdminLayout>;
  if (path === "/admin/payments") return <AdminLayout><AdminPayments /></AdminLayout>;
  if (path === "/admin/card-rates") return <AdminLayout><AdminCardRates /></AdminLayout>;
  if (path === "/admin/gmail-task") return <AdminLayout><AdminGmailTask /></AdminLayout>;
  if (path === "/admin/guides") return <AdminLayout><AdminGuides /></AdminLayout>;
  if (path === "/admin/payment-methods") return <AdminLayout><AdminPaymentMethods /></AdminLayout>;
  // /admin/users is a legacy bookmark — user management now lives in the
  // dedicated Members section.
  if (path === "/admin/users") return <AdminLayout><AdminMembers /></AdminLayout>;
  if (path === "/admin/members") return <AdminLayout><AdminMembers /></AdminLayout>;
  if (path === "/admin/branding") return <AdminLayout><AdminBranding /></AdminLayout>;
  if (path === "/admin/settings") return <AdminLayout><AdminSettings /></AdminLayout>;

  // Static pages
  if (path === "/privacy") return <PrivacyView />;
  if (path === "/terms") return <TermsView />;
  if (path === "/contact") return <ContactView />;

  return <NotFoundView />;
}

function Router() {
  const { path } = useRoute();
  const { user, loadingAuth } = useApp();
  const reduce = useReducedMotion();

  // Dashboard is the default landing page for authenticated users: opening
  // the site root (or clicking the logo) takes a signed-in member straight to
  // their Dashboard instead of the marketing landing page. Signed-out
  // visitors keep seeing the landing page. `replace` swaps the root history
  // entry in place (no back-button trap), and the redirect waits for the
  // session check so logged-out visitors are never bounced.
  useEffect(() => {
    if (!loadingAuth && user && (path === "/" || path === "")) {
      navigate("/dashboard", { replace: true });
    }
  }, [loadingAuth, user, path]);

  useEffect(() => {
    const match = TITLES.find(([re]) => re.test(path));
    const title = match ? `${match[1]} | Muxamil.co` : "Muxamil Work Hub | Muxamil.co";
    document.title = title;
    // On a hard refresh of a deep hash link, React/Next hydration re-asserts
    // the server-rendered <title> right after mount and can overwrite the
    // value set above — re-apply once the document has settled so the tab
    // label always matches the active view under the shared Muxamil brand.
    const reassert = window.setTimeout(() => {
      document.title = title;
    }, 400);
    return () => window.clearTimeout(reassert);
  }, [path]);

  const view = viewFor(path);

  // Keyed by route path: each navigation remounts the view with a short
  // cinematic fade + 12px rise (240ms, shared ease) — never delays the
  // action itself, and collapses entirely under reduced motion.
  return (
    <motion.div
      key={path}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {view}
    </motion.div>
  );
}

export default function WorkGuidelineRouter() {
  return <Router />;
}
