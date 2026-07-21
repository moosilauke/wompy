import { BrandMark } from "@/components/ui/BrandMark";
import { Bubble, BubbleRow, DayDivider } from "@/components/ui/Bubble";
import { RailRow } from "@/components/ui/RailRow";
import { AuthModal } from "./AuthModal";
import { AuthTrigger } from "./AuthTrigger";
import { MoreLinks } from "./MoreLinks";
import { SignupComposer } from "./SignupComposer";
import { DEMO_CONTACTS, FEATURES, PLANS } from "./content";

/**
 * The landing page, which IS the app shell.
 *
 * Per the design handoff: an unauthenticated visitor lands directly in a mock
 * conversation with the Wompy account, which pitches the product as chat
 * messages, and the sign-up field is the composer. There should be no visual
 * seam between the marketing site and the logged-in app — which is why this
 * renders through the same primitives the app uses rather than its own markup.
 *
 * Where it deviates, it deviates in behaviour, not appearance: the rail rows
 * don't navigate, the bubbles have no context menus, and the composer signs you
 * up instead of sending mail. None of that machinery is imported here, so a
 * visitor downloads none of it.
 *
 * Nav shows the app's real tabs (Contacts / Companies) rather than the mockup's
 * All/Personal/Work/Promotions — tabs that vanished on sign-up would break the
 * seamlessness the design is built around.
 */
export function LandingPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-spruce-edge bg-spruce px-7 shadow-[0_2px_12px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-7">
          <BrandMark />
          <nav className="hidden items-center gap-1 md:flex" aria-hidden>
            {/* Decorative: a signed-out visitor has no inbox to filter. */}
            <span className="rounded-[10px] bg-[oklch(0.8_0.13_175_/_0.25)] px-[13px] py-[7px] text-[13px] font-bold text-white">
              Contacts
            </span>
            <span className="rounded-[10px] px-[13px] py-[7px] text-[13px] font-bold text-on-spruce-muted">
              Companies
            </span>
          </nav>
        </div>

        <AuthTrigger />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Contact rail — spruce, matching the app. Hidden on small screens:
            on a phone the pitch is the conversation, and a 320px rail would
            leave no room for it. */}
        <aside className="hidden w-[320px] shrink-0 flex-col border-r border-spruce-edge bg-spruce shadow-[2px_0_16px_rgba(0,0,0,0.15)] lg:flex">
          <div className="px-4 pb-2.5 pt-4">
            <div
              className="flex items-center gap-2 rounded-[14px] bg-spruce-raised px-3.5 py-2.5"
              aria-hidden
            >
              <span className="h-4 w-4 shrink-0 rounded-full border-2 border-on-spruce-muted" />
              <span className="text-sm font-semibold text-on-spruce-muted">
                Search people or messages
              </span>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
            <ul className="flex flex-col gap-0.5">
              {DEMO_CONTACTS.map((c) => (
                <li key={c.name}>
                  {/* Inert: these are illustrations, not links. */}
                  <RailRow
                    address={c.address}
                    label={c.name}
                    timestamp={c.time}
                    snippet={c.snippet}
                    unread={c.unread}
                    active={c.active}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <MoreLinks />
        </aside>

        {/* Reading pane — the pitch, delivered as a conversation. */}
        <section className="flex min-w-0 flex-1 flex-col bg-reading-pane">
          <div className="flex h-[76px] shrink-0 items-center gap-3.5 border-b border-black/[0.06] bg-cream px-7 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-mint text-[17px] font-extrabold text-white"
            >
              W
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="truncate font-display text-[17px] font-bold text-text-body">
                Wompy
              </h1>
              <p className="truncate text-[13px] font-semibold text-[oklch(0.62_0.11_175)]">
                ● Official account
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-7 md:px-10">
            <DayDivider label="TODAY" />

            <BubbleRow>
              <Bubble>
                <p>Hey 👋 I&rsquo;m Wompy.</p>
              </Bubble>
            </BubbleRow>

            <BubbleRow>
              <Bubble>
                <p>
                  I turn your inbox into one continuous conversation per
                  person. It&rsquo;s email built like texting in 2026, not
                  letter-writing in 1926.
                </p>
              </Bubble>
            </BubbleRow>

            {FEATURES.map((f) => (
              <BubbleRow key={f.title}>
                <Bubble>
                  <span className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`mt-0.5 inline-block h-[34px] w-[34px] shrink-0 rounded-[10px] ${f.chip}`}
                    />
                    <span className="min-w-0">
                      <span className="block font-bold">{f.title}</span>
                      <span className="block text-[14px] text-text-muted">
                        {f.body}
                      </span>
                    </span>
                  </span>
                </Bubble>
              </BubbleRow>
            ))}

            <BubbleRow>
              <Bubble>
                <p className="mb-2.5">Pick a plan whenever you&rsquo;re ready:</p>
                <span className="flex flex-wrap gap-2">
                  {PLANS.map((p) => (
                    <span
                      key={p.label}
                      className={`rounded-full px-[15px] py-[9px] text-[13px] font-extrabold ${
                        p.popular
                          ? "bg-coral text-white shadow-[0_3px_10px_oklch(0.5_0.12_25_/_0.35)]"
                          : "bg-[#f0ece3] text-[#3a352c]"
                      }`}
                    >
                      {p.label}
                    </span>
                  ))}
                </span>
              </Bubble>
            </BubbleRow>

            <BubbleRow>
              <Bubble outgoing>
                <p>
                  Ready to bring your inbox to life? Reply below and I&rsquo;ll
                  set you up. 👇
                </p>
              </Bubble>
            </BubbleRow>
          </div>

          <SignupComposer />
        </section>
      </div>

      {/* Renders nothing until ?auth=1 is present. */}
      <AuthModal />
    </div>
  );
}
