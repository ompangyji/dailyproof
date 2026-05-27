import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md card-brut p-8 space-y-6">
        <header className="text-center">
          <h1 className="font-display text-4xl">Sign up</h1>
          <p className="font-tag text-coral text-xl mt-1 rotate-2 inline-block">
            welcome aboard!
          </p>
        </header>
        <SignupForm />
      </div>
    </main>
  );
}
