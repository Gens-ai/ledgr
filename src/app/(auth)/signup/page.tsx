import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/signup-form";
import { isSignupDisabled } from "@/lib/auth/signup";

export default async function SignupPage() {
  // Read LEDGR_DISABLE_SIGNUP per request, not at build time — the Docker image
  // is built once and the flag is set by whoever runs it.
  await connection();

  if (isSignupDisabled()) {
    return (
      <AuthCard
        title="Sign-up is disabled"
        description="Sign-up is disabled on this instance. Ask its owner for an account."
        footer={{
          text: "Already have an account?",
          linkText: "Sign in",
          href: "/login",
        }}
      >
        {null}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start tracking your finances"
      footer={{
        text: "Already have an account?",
        linkText: "Sign in",
        href: "/login",
      }}
    >
      <SignupForm />
    </AuthCard>
  );
}
