# Email — what sends what, from where

**Every fact here is a dashboard setting or a DNS record**, so none of it has a file behind it and
none of it can be gated. `docs/ENVIRONMENTS.md` §Auth configuration is the contract for the rest of
that door; this file covers only the mail itself. **Keep the probes, not the verdicts** — each
reading below is dated, and the command beside it is what makes a stale line cost seconds.

## The senders differ per project, and that is not intentional

| | PROD `letsride` (`zwprydcyryvudhurbnye`) | DEV `Letsride-dev` (`fpmrimzxadewsaiwpsel`) |
|---|---|---|
| Sends auth mail as | `Let's Ride <noreply@letsride.social>` | `noreply@mail.app.supabase.io` |
| Through | **Resend** (SMTP relay, `eu-west-1`, SES underneath) | Supabase's shared built-in sender |
| Auth mail a rider can receive | confirm signup, password reset | password reset only — autoconfirm is on, so no confirmation mail is ever sent |
| Templates | Supabase's defaults | Supabase's defaults |

Measured 2026-09-05. **DEV's custom SMTP is PD-108's remaining work, not a decision** — it was
missed rather than declined.

**The built-in sender is best-effort with no delivery signal and a rate limit measured in single
digits per hour.** That is why PROD moved off it, and it is why nothing that matters should be
proven on DEV.

### Reading the sender back — the only way is to make one arrive

There is no API for this. Send one and read the headers:

```bash
# a confirmation mail (PROD only — DEV autoconfirms and sends nothing)
curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" \
  -H "apikey: <publishable>" -H "Content-Type: application/json" \
  -d '{"email":"you+probe@gmail.com","password":"<anything>"}'

# a password-reset mail (either project, and it creates no row)
curl -s -X POST "https://<ref>.supabase.co/auth/v1/recover" \
  -H "apikey: <publishable>" -H "Content-Type: application/json" \
  -d '{"email":"<an address that already has an account>"}'
```

Then read the delivered message's `From:`, `DKIM-Signature: … d=` and `Authentication-Results:`.
A mail from Resend carries `d=letsride.social s=resend`, a `Return-Path` on
`send.letsride.social`, and Supabase's own `X-Pm-Metadata-Project-Ref` naming the project — so one
header block answers "which sender" and "which project" together.

**The signup form leaves a row on a production auth server.** Delete it, and prove it:

```sql
delete from auth.users where email = '<the probe address>';
select count(*) from auth.users where email like 'you+%';   -- expect 0
```

## DNS lives at name.com, and the mail records are Resend's

Nameservers are `ns1gmz` / `ns2bls` / `ns3fgh` / `ns4lpv.name.com`. `docs/ENVIRONMENTS.md`
§Domains carries why DNS stays at the registrar and the two name.com-specific traps (the **Host**
field takes the bare label; the apex is the empty Host).

```bash
node -e "const{Resolver}=require('dns/promises');const r=new Resolver();
(async()=>{for(const n of['letsride.social','send.letsride.social','_dmarc.letsride.social','resend._domainkey.letsride.social'])
 {for(const [k,f] of [['TXT',r.resolveTxt],['MX ',r.resolveMx]])
  {try{console.log(k,n,JSON.stringify(await f.call(r,n)).slice(0,90))}catch(e){console.log(k,n,e.code)}}}})()"
```

| Name | Record | Reading, 2026-09-05 |
|---|---|---|
| `send.letsride.social` | TXT | `v=spf1 include:amazonses.com ~all` — the SPF that actually authorises the mail, because `MAIL FROM` is on this subdomain |
| `send.letsride.social` | MX | `feedback-smtp.eu-west-1.amazonses.com` — where bounces go |
| `resend._domainkey.letsride.social` | TXT | the DKIM public key; `d=letsride.social` on every delivered message |
| `_dmarc.letsride.social` | TXT | `v=DMARC1; p=none;` — **no `rua`, so it collects nothing** |
| `letsride.social` (apex) | TXT | **absent — the apex publishes no SPF at all** |

**DMARC passes on DKIM alignment, not SPF alignment**, and that is worth knowing before anyone
edits these. The header `From:` is `@letsride.social` while `MAIL FROM` is `@send.letsride.social`,
so SPF is aligned only in the relaxed sense; what carries DMARC is the `d=letsride.social` DKIM
signature. Consequence: an apex SPF record cannot break the mail that works today, and a broken
DKIM key would break it entirely.

The apex has **no MX**, so nothing can receive at `@letsride.social` — `noreply@` is a real
one-way address rather than a convention.

## Templates: three files, six fields per project, and no read-back

`supabase/templates/` holds one HTML body per dashboard field, pasted by hand into
Authentication → Emails on both projects. **The files are the source of truth by convention only**
— `supabase/templates/README.md` §This directory is the source of truth by convention only has the
full argument, the subject lines, and the four-copies-of-one-URL rule.

**Nothing can read a deployed template back**: no MCP tool, no credential-free probe, and the
Management API's config endpoint needs a personal access token this environment does not hold. So
the drift is not merely ungated, it is unobservable from a session.

**What a session *can* see is the rendered link**, because that arrives in an inbox — which is how
2026-09-05 established that both projects were still serving Supabase's defaults three weeks after
the files landed. Send one with the `curl` above and look at what the button points at:

| Link in the mail | Means |
|---|---|
| `https://<ref>.supabase.co/auth/v1/verify?token=…&type=signup` | the **default** template — `{{ .ConfirmationURL }}`, PKCE, same-device only |
| `https://app.letsride.social/auth/confirm?token_hash=…&type=signup&next=/postcards` | `confirm-signup.html` is pasted — `verifyOtp`, works on any device |

That is the whole check for the field that matters, and it is the only one that reads the live
project rather than the repo.

## The rate limit is a separate page and it defaults low

**Authentication → Rate Limits → *Rate limit for sending emails*.** Supabase imposes **30 messages
per hour** the moment custom SMTP is saved — configuring SMTP *lowers* this ceiling rather than
raising it, which is the opposite of what the change is for. It is not readable from a session.

**The failure is silent on every surface.** Over the limit, GoTrue stamps `confirmation_sent_at`
and sends nothing: `signUp` returns the same `{ sent: true }`, `/auth/signup` renders the same
"Check your email" screen, and the rider waits for a message that does not exist — and cannot sign
in either, because sign-in is refused until confirmation. Observed on PROD 2026-08-28, and the
account-level symptom is readable afterwards:

```sql
select email, confirmation_sent_at, email_confirmed_at
from auth.users where email_confirmed_at is null and confirmation_sent_at is not null;
```

A row that stays in that state is either an un-clicked link or an un-sent mail, and **nothing in
the database distinguishes them.** The provider's own log does: Resend → Emails.

Resend's free tier is a second ceiling — 3,000/month and **100/day** — and it is the one a launch
day reaches first.

## Something follows the confirmation link before the rider does

`email_confirmed_at` has been stamped between ten and fifty seconds after `confirmation_sent_at` on
every measured PROD signup, with nobody clicking. PD-337 holds it. Two things are eliminated: it
happens under **both** senders, so it is not Resend and not the built-in mailer, and it happens
with delivery latency of one second, so it is not a queue racing an OTP lifetime.

```sql
select email, confirmation_sent_at, email_confirmed_at,
       (email_confirmed_at - confirmation_sent_at) as delta
from auth.users where email_confirmed_at is not null and confirmation_sent_at is not null
order by created_at desc;
```

The live rows still carry it, across two mail providers. **The likely fix is PD-233 rather than
PD-108**: `/auth/v1/verify` is spent by a plain GET, whereas `/auth/confirm` calls `verifyOtp` from
a client component, so a follower that does not run JavaScript cannot spend the token. That is a
mechanism and not a measurement — PD-337 carries the experiment that settles it.
