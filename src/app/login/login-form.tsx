import { sanitizeRedirect } from "@/lib/redirect";
export function LoginForm({ redirectTo }: { redirectTo: string }) {
  return (
    <form action="/api/auth/discord" method="get" className="login-form">
      <input
        type="hidden"
        name="redirectTo"
        value={sanitizeRedirect(redirectTo)}
      />
      <button type="submit">Discord로 로그인</button>
    </form>
  );
}
