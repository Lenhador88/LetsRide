# Email — what sends what, from where

**Every fact here is a dashboard setting or a DNS record**, so none of it has a file behind it and
none of it can be gated by CI. `docs/ENVIRONMENTS.md` §Auth configuration is the contract for the
rest of that door; this file covers the mail itself. **Keep the probes, not the verdicts** — each
reading is dated, and the command beside it is what makes a stale line cost seconds.

## The senders differ per project, and that is not intentional

| | PROD `letsride` (`zwprydcyryvudhurbnye`) | DEV `Letsride-dev` (`fpmrimzxadewsaiwpsel`) |
|---|---|---|
| Sends auth mail as | `Let's Ride <noreply@letsride.social>` | `noreply@mail.app.supabase.io` |
| Through | **Resend** (SMTP relay, `eu-west-1`, SES underneath) | Supabase's shared built-in sender |
| Auth mail a rider can receive | confirm signup, password reset | password reset only — autoconfirm is on, so no confirmation mail is ever sent |
| Templates | Supabase's defaults | Supabase's defaults |

Measured 2026-09-05. **DEV's custom SMTP is PD-108's remaining work, not a decision** — it was
missed rather than declined.

The built-in sender is documented as best-effort, with no delivery SLA and a send limit **below**
the custom-SMTP ceiling in §The rate limit below. Supabase renders that number dynamically in its
own docs rather than writing it in prose, so it is not quoted here.

### Reading the sender back — the only way is to make one arrive

There is no API for this and no credential-free probe. Send one and read the headers:

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

A mail from Resend carries `d=letsride.social s=resend`, a `Return-Path` on
`send.letsride.social`, and Supabase's own `X-Pm-Metadata-Project-Ref` naming the project — so one
header block answers "which sender" and "which project" together.

**The signup form leaves a row on a production auth server.** Delete it, and re-select the same
address rather than a placeholder pattern — a `like 'you+%'` returns 0 whether or not the delete
landed, which manufactures a clean:

```sql
delete from auth.users where email = '<the probe address>';
select count(*) from auth.users where email = '<the probe address>';   -- expect 0
```

## DNS lives at name.com, and the mail records are Resend's

```bash
node -e "const{Resolver}=require('dns/promises');const r=new Resolver();
(async()=>{console.log('NS ',await r.resolveNs('letsride.social'));
 for(const n of['letsride.social','send.letsride.social','_dmarc.letsride.social','resend._domainkey.letsride.social'])
 {for(const [k,f] of [['TXT',r.resolveTxt],['MX ',r.resolveMx]])
  {try{console.log(k,n,JSON.stringify(await f.call(r,n)).slice(0,90))}catch(e){console.log(k,n,e.code)}}}})()"
```

| Name | Record | Reading, 2026-09-05 |
|---|---|---|
| `letsride.social` | NS | `ns1gmz` / `ns2bls` / `ns3fgh` / `ns4lpv.name.com` — so every record below is edited in name.com's panel |
| `send.letsride.social` | TXT | `v=spf1 include:amazonses.com ~all` — the SPF that authorises the mail, because `MAIL FROM` is on this subdomain |
| `send.letsride.social` | MX | `feedback-smtp.eu-west-1.amazonses.com` — where bounces go |
| `resend._domainkey.letsride.social` | TXT | the DKIM public key; `d=letsride.social` on every delivered message |
| `_dmarc.letsride.social` | TXT | `v=DMARC1; p=none;` — **no `rua`, so it collects nothing**, and `p=none` asks no receiver to do anything |
| `letsride.social` (apex) | TXT | **absent — the apex publishes no SPF at all** |

`docs/ENVIRONMENTS.md` §Domains carries why DNS stays at the registrar, and name.com's own trap:
the **Host** field takes the bare label (`app`, not the FQDN). The apex is the empty Host, which
that section does not say and PD-34 will need.

**Both aligned identifiers pass, and getting this backwards is expensive**, because it decides
what an apex SPF record can break. Read off a delivered message's `Authentication-Results`:

- `spf=pass … smtp.mailfrom=…@send.letsride.social`
- `dkim=pass header.i=@letsride.social header.s=resend`
- `dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=letsride.social`

`_dmarc` carries no `aspf` or `adkim` tag, so **both alignments are relaxed** — the default — and
relaxed compares organizational domains. `send.letsride.social` and `letsride.social` share one,
so **SPF is aligned and passing as well as DKIM**. DMARC needs only one; it currently has both,
which is the redundancy worth keeping.

The consequence to carry, and it does **not** depend on which identifier aligns: **an apex SPF
record cannot affect this mail, because SPF is evaluated against the `MAIL FROM` domain and that
is `send.letsride.social`.** The apex record is never consulted. It only ever answers for mail
*claiming* `@letsride.social` directly — which is the spoofer, and is exactly what publishing
`v=spf1 -all` there refuses. PD-108 carries that step and the `p=none` → `p=quarantine` →
`p=reject` schedule, plus the condition that would make `-all` wrong: an apex mailbox, which
needs an apex MX, and there is none today.

## Templates: three files, six fields per project

`supabase/templates/` holds one body per dashboard field, pasted by hand into Authentication →
Emails on both projects. **`docs/ENVIRONMENTS.md` §The email templates have files now, and still
no gate is the argument**, and `supabase/templates/README.md` has the field mapping, the subject
lines, and the four-copies-of-one-URL rule. What belongs here is only how to read the live state,
because that section says it cannot be done and it half can:

**No template can be read back as markup** — no MCP tool, no credential-free probe, and the
Management API's config endpoint needs a personal access token this environment does not hold. But
a mail that *arrives* carries the rendered result, and for one field that is enough:

| Confirm signup — link in the delivered mail | Means |
|---|---|
| `https://<ref>.supabase.co/auth/v1/verify?token=…&type=signup` | the **default** template — `{{ .ConfirmationURL }}`, PKCE, same-device only |
| `https://app.letsride.social/auth/confirm?token_hash=…&type=signup&next=/postcards` | `confirm-signup.html` is pasted — `verifyOtp`, works on any device |

**That test works for *Confirm signup* and for nothing else.** `reset-password.html` deliberately
keeps `{{ .ConfirmationURL }}`, so its link is byte-identical whether the repo's file is pasted or
not; the discriminators there are the **subject** and the body prose. That is how DEV was read on
2026-09-05 — a recover mail whose subject was `Reset your password` rather than
`Reset your LetsRide password`. *Magic Link* cannot be read back at all: nothing in the app sends
one (`grep -rn "signInWithOtp" src/` is 0).

The file half does have a gate — `src/__tests__/auth-email-templates.test.ts` holds the links in
all three files identical to each other and to a constant in the test. It says nothing about what
a project serves.

## The rate limit is a separate page, and it is Supabase's rather than the provider's

**Authentication → Rate Limits → *Rate limit for sending emails*.** Supabase sets it to **30
messages per hour** when custom SMTP is saved — its docs call that "a low rate-limit" relative to
what a real provider can carry, not relative to the built-in mailer, whose limit is lower still.
So configuring SMTP *raises* the ceiling; it just raises it to a number far below what Resend
would accept, which makes **Supabase's cap the one that binds first**. It is not readable from a
session.

**Over the limit, the failure is silent on every surface.** GoTrue stamps `confirmation_sent_at`
and sends nothing: `signUp` returns the same `{ sent: true }` (`src/lib/actions/auth.ts`),
`/auth/signup` renders the same "Check your email", and the rider waits for a message that does
not exist — and cannot sign in either, because sign-in is refused until confirmation. Observed on
PROD 2026-08-28. The account-level symptom afterwards:

```sql
select email, created_at, confirmation_sent_at, email_confirmed_at
from auth.users where email_confirmed_at is null and confirmation_sent_at is not null;
```

A row in that state is either an un-clicked link or an un-sent mail, and **nothing in the database
distinguishes them.** The provider's own log does: Resend → Emails.

Resend's free tier is a second ceiling — 3,000/month and **100/day** — and it is the one a launch
day reaches first.

## Something follows the confirmation link, and PD-337 is where it lives

`email_confirmed_at` has been stamped seconds after `confirmation_sent_at` on measured PROD
signups where nobody clicked — 9.7s and 12.8s are still on the live database, and the deltas run
out to ~50s on rows since deleted. **PD-337 holds the question and its history; do not re-derive
the framing from this paragraph**, which records only what a *sender* change did and did not
explain:

```sql
select email, confirmation_sent_at, email_confirmed_at,
       (email_confirmed_at - confirmation_sent_at) as delta
from auth.users where email_confirmed_at is not null and confirmation_sent_at is not null
order by created_at desc;
```

Those surviving rows are both **pre-Resend**, and every Resend-era row was probe cleanup — so the
command above no longer shows the comparison, and that is the reason to read PD-337 rather than
this table. The comparison it made: the follow happens under **both** senders, and on a run
delivered one second after sending, so neither the sender nor a queue racing an OTP lifetime
explains it. **PD-337's own correction stands over all of this**: the follow happened on the
*green* runs too, so it is not what made the one red run red — the leading hypothesis there is a
time-dependent PKCE flow-state or auth-code expiry inside `exchangeCodeForSession`. And a run
whose mail was never delivered was never followed, which places the follower downstream of
delivery.

**PD-233 plausibly moots both**, which is the one thing this file adds: `/auth/confirm` takes a
`token_hash` through `verifyOtp`, so there is no PKCE auth code to expire, and spending the token
requires executing JavaScript rather than a plain GET. That is a mechanism, not a measurement, and
PD-337 carries the experiment that settles it.
