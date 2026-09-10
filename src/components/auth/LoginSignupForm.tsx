import { User, Lock, Mail, Loader2, Sparkles, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CobrAILogo } from "@/components/brand/CobrAILogo";

export type AuthMode = "login" | "signup";

export type LoginSignupFormProps = {
  mode: AuthMode;
  onToggle: (mode: AuthMode) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  error: string | null;
  info: string | null;
  submitting: boolean;
  inviteToken?: string;
  onSubmit: () => void;
  onMagicLink: () => void;
  onForgotPassword: () => void;
};

/**
 * Login / signup dual-panel with slide toggle. When `mode === "signup"` the
 * signup panel slides in from the right half and the gradient "toggle pill"
 * slides from the left side to the right. Keeps the three functional auth
 * paths of the cobrAI auth page:
 *   • password login
 *   • password signup (with optional invite_token)
 *   • magic link (secondary action inside the login panel)
 */
export function LoginSignupForm(props: LoginSignupFormProps) {
  const {
    mode,
    onToggle,
    email,
    setEmail,
    password,
    setPassword,
    name,
    setName,
    error,
    info,
    submitting,
    inviteToken,
    onSubmit,
    onMagicLink,
    onForgotPassword,
  } = props;

  const isActive = mode === "signup";

  return (
    <div className="w-full">
      {/* Mobile: single-panel stack, no animation */}
      <div className="md:hidden">
        <MobileCard
          mode={mode}
          onToggle={onToggle}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          name={name}
          setName={setName}
          error={error}
          info={info}
          submitting={submitting}
          inviteToken={inviteToken}
          onSubmit={onSubmit}
          onMagicLink={onMagicLink}
          onForgotPassword={onForgotPassword}
        />
      </div>

      {/* Desktop: dual-panel slide */}
      <div
        className={cn(
          "relative mx-auto hidden h-[600px] w-full max-w-[860px] overflow-hidden rounded-[28px] border border-white/[0.06] bg-card shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] md:block",
        )}
      >
        {/* LOGIN panel — lives on the right half by default, slides left when active */}
        <PanelContainer
          isActive={isActive}
          side="login"
        >
          <FormInner title="Entrar" subtitle="Acesse seu workspace cobrAI">
            {inviteToken && <InviteBanner />}
            <Input
              icon={Mail}
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <Input
              icon={Lock}
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />

            <div className="-mt-2 text-right">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Esqueci minha senha
              </button>
            </div>

            {error && <Alert tone="error">{error}</Alert>}
            {info && <Alert tone="info">{info}</Alert>}

            <PrimaryButton onClick={onSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Entrar
            </PrimaryButton>

            <Separator>ou</Separator>

            <button
              type="button"
              onClick={onMagicLink}
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              Entrar com link mágico
            </button>
          </FormInner>
        </PanelContainer>

        {/* SIGNUP panel — lives on the right half too, only visible when active */}
        <PanelContainer
          isActive={isActive}
          side="signup"
        >
          <FormInner
            title={inviteToken ? "Aceitar convite" : "Criar conta"}
            subtitle={
              inviteToken
                ? "Crie uma conta com o e-mail que recebeu o convite"
                : "Monte seu workspace em menos de 1 minuto"
            }
          >
            {inviteToken && <InviteBanner />}
            <Input
              icon={User}
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={setName}
              autoComplete="name"
            />
            <Input
              icon={Mail}
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <Input
              icon={Lock}
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />

            {error && <Alert tone="error">{error}</Alert>}
            {info && <Alert tone="info">{info}</Alert>}

            <PrimaryButton onClick={onSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {inviteToken ? "Aceitar convite e entrar" : "Criar workspace"}
            </PrimaryButton>
          </FormInner>
        </PanelContainer>

        {/* Toggle pill (animated gradient background) */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[2] overflow-hidden",
          )}
        >
          <div
            className={cn(
              "absolute top-0 h-full w-[300%] rounded-[150px] bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 transition-[left] duration-[1800ms] ease-in-out",
              isActive ? "left-1/2" : "-left-[250%]",
            )}
          />
        </div>

        {/* Toggle panels with invitation CTA */}
        <TogglePanel
          side="left"
          isActive={isActive}
          heading="Olá, bem-vindo! 👋"
          text="Ainda não tem conta? Monte seu workspace agora em menos de 1 minuto."
          cta={inviteToken ? "Aceitar convite" : "Criar conta"}
          onClick={() => onToggle("signup")}
        />
        <TogglePanel
          side="right"
          isActive={isActive}
          heading="De volta!"
          text="Já tem uma conta cobrAI? Entra aí pra continuar de onde parou."
          cta="Entrar"
          onClick={() => onToggle("login")}
        />
      </div>
    </div>
  );
}

/* ─── desktop panel wrapper ─── */

function PanelContainer({
  isActive,
  side,
  children,
}: {
  isActive: boolean;
  side: "login" | "signup";
  children: React.ReactNode;
}) {
  // Login panel is always rendered and visible; when active it slides left.
  // Signup panel stays at right-0 but is hidden until the pill has slid out of
  // the way, matching the original CSS's staged visibility timing.
  if (side === "login") {
    return (
      <div
        className={cn(
          "absolute top-0 z-[1] flex h-full w-1/2 items-center justify-center bg-card text-foreground transition-[right] duration-[600ms] ease-in-out",
          isActive ? "right-1/2 delay-[1200ms]" : "right-0 delay-[1200ms]",
          "transition-[opacity,visibility] duration-[600ms]",
          isActive
            ? "invisible opacity-0 delay-0"
            : "visible opacity-100 delay-[1200ms]",
        )}
        aria-hidden={isActive ? undefined : undefined}
      >
        {children}
      </div>
    );
  }
  // signup panel
  return (
    <div
      className={cn(
        "absolute left-0 top-0 z-[1] flex h-full w-1/2 items-center justify-center bg-card text-foreground",
        "transition-[opacity,visibility] duration-[600ms]",
        isActive
          ? "visible opacity-100 delay-[1200ms]"
          : "invisible opacity-0 delay-0",
      )}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  );
}

function FormInner({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col px-10 py-10">
      <div className="mb-5 flex items-center gap-2.5">
        <CobrAILogo size="sm" />
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          cobrAI · Agente de cobrança por voz
        </div>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

/* ─── toggle pill panels (desktop) ─── */

function TogglePanel({
  side,
  isActive,
  heading,
  text,
  cta,
  onClick,
}: {
  side: "left" | "right";
  isActive: boolean;
  heading: string;
  text: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "absolute z-[3] flex h-full w-1/2 flex-col items-center justify-center px-8 text-center text-white transition-all duration-[600ms] ease-in-out",
        side === "left" && (isActive ? "left-[-50%] delay-[600ms]" : "left-0 delay-[1200ms]"),
        side === "right" && (isActive ? "right-0 delay-[1200ms]" : "right-[-50%] delay-[600ms]"),
      )}
    >
      <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2>
      <p className="mt-4 max-w-xs text-sm text-white/85">{text}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-6 inline-flex h-11 w-44 items-center justify-center rounded-lg border-2 border-white/70 bg-transparent text-sm font-semibold text-white transition-colors hover:bg-white/10"
      >
        {cta}
      </button>
    </div>
  );
}

/* ─── mobile variant (no animation) ─── */

function MobileCard(props: LoginSignupFormProps) {
  const {
    mode,
    onToggle,
    email,
    setEmail,
    password,
    setPassword,
    name,
    setName,
    error,
    info,
    submitting,
    inviteToken,
    onSubmit,
    onMagicLink,
    onForgotPassword,
  } = props;

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.06] bg-card shadow-2xl">
      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-5 text-center text-white">
        <CobrAILogo size="sm" className="mx-auto" />
        <h2 className="mt-3 text-xl font-semibold">
          {isSignup
            ? inviteToken
              ? "Aceitar convite"
              : "Criar conta"
            : "Entrar"}
        </h2>
        <p className="mt-1 text-xs text-white/85">
          {isSignup
            ? "Preencha pra montar seu workspace"
            : "Acesse seu workspace cobrAI"}
        </p>
      </div>

      <FormInner title={isSignup ? "Dados" : "Login"} subtitle="">
        {inviteToken && <InviteBanner />}
        {isSignup && (
          <Input
            icon={User}
            type="text"
            placeholder="Seu nome"
            value={name}
            onChange={setName}
            autoComplete="name"
          />
        )}
        <Input
          icon={Mail}
          type="email"
          placeholder="seu@email.com"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Input
          icon={Lock}
          type="password"
          placeholder={isSignup ? "Mínimo 8 caracteres" : "Sua senha"}
          value={password}
          onChange={setPassword}
          autoComplete={isSignup ? "new-password" : "current-password"}
        />

        {!isSignup && (
          <div className="-mt-2 text-right">
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Esqueci minha senha
            </button>
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        {info && <Alert tone="info">{info}</Alert>}

        <PrimaryButton onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isSignup ? <UserPlus className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {isSignup
            ? inviteToken
              ? "Aceitar convite"
              : "Criar workspace"
            : "Entrar"}
        </PrimaryButton>

        {!isSignup && (
          <>
            <Separator>ou</Separator>
            <button
              type="button"
              onClick={onMagicLink}
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              Entrar com link mágico
            </button>
          </>
        )}

        <div className="pt-2 text-center text-xs text-muted-foreground">
          {isSignup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
          <button
            type="button"
            onClick={() => onToggle(isSignup ? "login" : "signup")}
            className="font-semibold text-violet-300 hover:underline"
          >
            {isSignup ? "Entrar" : inviteToken ? "Aceitar convite" : "Criar agora"}
          </button>
        </div>
      </FormInner>
    </div>
  );
}

/* ─── building blocks ─── */

function Input({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  icon: React.ComponentType<{ className?: string }>;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] pl-4 pr-11 text-sm font-medium text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <Icon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(139,92,246,0.6)] transition-opacity hover:opacity-95 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Alert({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {children}
    </div>
  );
}

function InviteBanner() {
  return (
    <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <UserPlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
        <div>
          <div className="font-medium text-violet-200">Você foi convidado</div>
          <div className="mt-0.5 text-violet-200/80">
            Use o e-mail que recebeu o convite pra entrar no workspace.
          </div>
        </div>
      </div>
    </div>
  );
}

function Separator({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
      <div className="h-px flex-1 bg-white/[0.08]" />
      <span>{children}</span>
      <div className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}
